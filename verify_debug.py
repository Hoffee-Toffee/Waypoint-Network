import asyncio
from playwright.async_api import async_playwright
import os

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        errors = []
        page.on("pageerror", lambda exc: errors.append(f"Uncaught exception: {exc}"))
        page.on("console", lambda msg: errors.append(f"Console {msg.type}: {msg.text}") if msg.type == "error" else None)

        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)
        await asyncio.sleep(1)

        # Check environment
        num_stations = await page.evaluate("Object.keys(Sim.stations).length")
        num_bridges = await page.evaluate("Object.keys(Sim.bridges).length")
        print(f"Stations: {num_stations}, Bridges: {num_bridges}")

        # Check jittered start
        jitter_check = await page.evaluate("""
            const sid = Object.keys(Sim.stations)[0];
            const station = Sim.stations[sid];
            const nid = Object.keys(station.commConduitMap)[0];
            const pairId = sid < nid ? sid + nid : nid + sid;
            let hash = 0;
            for (let i = 0; i < pairId.length; i++) hash = (hash << 5) - hash + pairId.charCodeAt(i);
            const jitter = Math.abs(hash % 60);
            const effectiveCadence = Math.min(station.baseCadenceSeconds, Sim.stations[nid].baseCadenceSeconds);
            const lastSent = station.lastHeartbeatSent[nid] ?? (jitter - effectiveCadence);
            ({ jitter, effectiveCadence, lastSent, now: Sim.simTimeSec })
        """)
        print(f"Jitter check: {jitter_check}")

        # Advance time
        for _ in range(100):
            await page.evaluate("tickFrame()")

        final_count = await page.evaluate("Sim.messages.length")
        print(f"Messages after 100s: {final_count}")

        if errors:
            print("Errors found:")
            for e in errors:
                print(f"  {e}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
