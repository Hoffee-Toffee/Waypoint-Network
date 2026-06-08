import asyncio
from playwright.async_api import async_playwright
import os

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)

        # Check stations
        num_stations = await page.evaluate("Object.keys(Sim.stations).length")
        print(f"Number of stations: {num_stations}")

        # Switch to Analyst tab
        await page.evaluate("document.getElementById('tab-analyst').click()")
        await asyncio.sleep(0.5)

        # Check selectors
        src = await page.evaluate("document.getElementById('analyst-source').value")
        dest = await page.evaluate("document.getElementById('analyst-dest').value")
        print(f"Source: {src}, Dest: {dest}")

        # Trigger analysis
        await page.evaluate("document.getElementById('btn-analyst-run').click()")
        await asyncio.sleep(0.5)

        messages = await page.evaluate("Sim.messages")
        print(f"Messages count: {len(messages)}")

        if len(messages) > 0:
            msg = messages[0]
            print(f"Message 0: id={msg['id']}, path={msg.get('path')}, analystPath={msg.get('analystPath')}")

            # Check duplicate listener fix
            # Click tab again
            await page.evaluate("document.getElementById('tab-analyst').click()")
            await asyncio.sleep(0.1)
            # Click run again
            await page.evaluate("document.getElementById('btn-analyst-run').click()")
            messages_after = await page.evaluate("Sim.messages")
            print(f"Messages count after second click: {len(messages_after)}")

            # Check scheduler overlap fix
            # To verify this we need to check the scheduled times of overlapping messages
            # We already have two messages now if the second click worked.
            if len(messages_after) >= 2:
                m1 = messages_after[0]
                m2 = messages_after[1]
                # We need to run a tick to get them scheduled
                await page.evaluate("tickFrame()")
                # Re-fetch from map because they were updated
                m1 = await page.evaluate(f"Sim.messageMap['{m1['id']}']")
                m2 = await page.evaluate(f"Sim.messageMap['{m2['id']}']")
                print(f"M1 scheduled departure: {m1.get('scheduledDeparture')}")
                print(f"M2 scheduled departure: {m2.get('scheduledDeparture')}")

                # Check if M2 starts after M1 ends if they use the same conduit
                # This is hard to verify without knowing which conduit they got,
                # but we can check if they are at least different.

        await page.screenshot(path="verification_v3.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
