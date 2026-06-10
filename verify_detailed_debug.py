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

        # Advance time
        for _ in range(30):
            await page.evaluate("tickFrame()")

        debug_info = await page.evaluate("""
            const sid = Object.keys(Sim.stations)[0];
            const st = Sim.stations[sid];
            const nid = Object.keys(st.commConduitMap)[0];
            const lastSent = st.lastHeartbeatSent[nid];
            const diff = Sim.simTimeSec - lastSent;
            const pending = st.pendingCheckinDests.has(nid);
            ({ time: Sim.simTimeSec, lastSent, diff, pending, msgCount: Sim.messages.length })
        """)
        print(f"Debug Info: {debug_info}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
