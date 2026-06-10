import asyncio
from playwright.async_api import async_playwright
import os

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)
        await asyncio.sleep(1)

        # 1. Faster sim
        await page.evaluate("Sim.deltaSec = 60; Sim.paused = false")

        # 2. Switch to Analyst
        await page.evaluate("document.getElementById('tab-analyst').click()")
        await asyncio.sleep(0.5)

        # 3. DATA Scenario
        print("Testing DATA protocol...")
        await page.evaluate("""
            document.getElementById('analyst-source').value = 'gj_65a_station';
            document.getElementById('analyst-dest').value = 'gj_65b_station';
            document.getElementById('analyst-type').value = 'data';
            document.getElementById('btn-analyst-run').click();
        """)

        # gj_65a and gj_65b are very close (binary pair), so this should be fast
        success = False
        for _ in range(500):
            await page.evaluate("tickFrame()")
            logs = await page.evaluate("document.getElementById('log-entries').innerText")
            if "Dispatching data" in logs:
                print(f"Step {_}: Data Handshake SUCCESS.")
                success = True
                break

        if not success:
            print("Data Handshake FAILED.")

        # 4. VESSEL Scenario (needs alignment)
        print("Testing VESSEL protocol (needs range alignment)...")
        # GJ 3512 to GJ 3379 (known bAimed=True, aAimed=False initially)
        await page.evaluate("""
            UI.reset();
            Sim.deltaSec = 60;
            Sim.paused = false;
            document.getElementById('analyst-source').value = 'gj_3512_station';
            document.getElementById('analyst-dest').value = 'gj_3379_station';
            document.getElementById('analyst-type').value = 'vessel_transit';
            document.getElementById('btn-analyst-run').click();
        """)

        success = False
        for _ in range(2000):
            await page.evaluate("tickFrame()")
            logs = await page.evaluate("document.getElementById('log-entries').innerText")
            if "Dispatching vessel_transit" in logs:
                print(f"Step {_}: Vessel Handshake SUCCESS.")
                success = True
                break
            if _ % 500 == 0:
                print(f"Step {_}...")

        if not success:
            print("Vessel Handshake FAILED.")

        await page.screenshot(path="final_protocol_test_v3.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
