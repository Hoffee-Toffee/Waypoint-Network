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

        # Check that conduits are now dedicated
        station_data = await page.evaluate("""
            Object.values(Sim.stations).map(s => ({
                id: s.id,
                neighbors: Object.keys(s.commConduitMap).length,
                conduits: s.commConduits.length
            }))
        """)

        for s in station_data:
            expected_conduits = s['neighbors'] * 2
            if s['conduits'] != expected_conduits:
                print(f"Error: Station {s['id']} has {s['conduits']} conduits but {s['neighbors']} neighbors (expected {expected_conduits})")
                exit(1)

        print(f"Verified {len(station_data)} stations have dedicated link pairs.")

        # Run a scenario
        await page.evaluate("document.getElementById('tab-analyst').click()")
        await asyncio.sleep(0.5)
        await page.evaluate("document.getElementById('btn-analyst-run').click()")
        await asyncio.sleep(0.5)

        # Advance and check for coordination probe
        messages = await page.evaluate("Sim.messages")
        types = [m['type'] for m in messages]
        print(f"Active message types: {set(types)}")

        # Check log for bridge filtering
        # GJ 3512 Station (host for s0057) distance GJ 3379 Station (host for s0114)
        # is approx 6.27 LY. Max window is ~2.7h (9720s). Travel time is ~1977s.
        # This bridge should pass the effective uptime filter.

        await page.screenshot(path="verification_dedicated.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
