import time
import os
from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Path to local index.html
        curr_dir = os.getcwd()
        url = f"file://{curr_dir}/index.html"
        page.goto(url)

        # Give it a moment to init
        page.wait_for_timeout(1000)

        # 1. Open Analyst Tab
        page.click("#tab-analyst")

        # 2. Select Source: Sol Station, Dest: Sirius Station
        # The IDs in the dropdown are the station IDs
        page.select_option("#analyst-source", value="sol_station")
        page.select_option("#analyst-dest", value="sirius_station")
        page.select_option("#analyst-type", value="vessel_transit")

        # 3. Set speed to 1000x
        page.select_option("#sel-speed", value="1000")

        # 4. Run Analyst Scenario
        print("Starting Analyst Scenario: Sol -> Sirius (Vessel)")
        page.click("#btn-analyst-run")

        # 5. Monitor logs for protocol milestones
        # We want to see 'Protocol Initiated', 'Leg Booked', 'Forwarding manifest', 'Leg Confirmed'
        found_booked = False
        found_forwarded = False
        found_confirmed = False
        found_success = False

        start_time = time.time()
        timeout = 240 # 4 minutes real time

        while time.time() - start_time < timeout:
            logs = page.inner_text("#log-entries")

            if "Leg Booked" in logs and not found_booked:
                print("Observed: Leg Booked")
                found_booked = True
            if "Forwarding manifest" in logs and not found_forwarded:
                print("Observed: Forwarding manifest")
                found_forwarded = True
            if "Leg Confirmed" in logs and not found_confirmed:
                print("Observed: Leg Confirmed")
                found_confirmed = True
            if "SUCCESS: vessel_transit reached final destination" in logs:
                print("Observed: Final Success")
                found_success = True
                break

            page.wait_for_timeout(2000)

        # Take a screenshot of the log and map
        page.screenshot(path="verification_multihop.png")

        if found_success:
            print("Multi-hop coordination verified successfully!")
        else:
            print("Verification timed out or failed to observe all milestones.")
            print("Final Logs:\n", page.inner_text("#log-entries")[-1000:])

        browser.close()

if __name__ == "__main__":
    run_verification()
