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

        los_check = await page.evaluate("""
            const bridge = Object.values(Sim.bridges)[0];
            const sA = Sim.stations[bridge.stationAId];
            const sB = Sim.stations[bridge.stationBId];
            const hasLos = Physics.hasLOS(sA, sB, bridge.occluderStars);
            ({ id: bridge.id, los: bridge.los, hasLos })
        """)
        print(f"LOS Check: {los_check}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
