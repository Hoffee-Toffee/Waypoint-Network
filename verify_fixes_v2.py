import asyncio
from playwright.async_api import async_playwright
import os

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Load the application
        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)

        # 1. Switch to Analyst tab
        await page.evaluate("document.getElementById('tab-analyst').click()")
        await asyncio.sleep(0.5)

        # 2. Trigger analysis (first time)
        await page.evaluate("document.getElementById('btn-analyst-run').click()")
        await asyncio.sleep(0.5)

        # 3. Trigger analysis (second time - check for duplicate listeners if we didn't fix it)
        # We can check the manifest count
        count_before = await page.evaluate("Sim.messages.length")
        await page.evaluate("document.getElementById('btn-analyst-run').click()")
        count_after = await page.evaluate("Sim.messages.length")

        print(f"Messages before second click: {count_before}")
        print(f"Messages after second click: {count_after}")

        # 4. Check if path is visible in manifest/renderer after one hop
        # We can manually advance time or just check the code logic via evaluation
        msg_id = await page.evaluate("Sim.messages[0].id")
        path_len = await page.evaluate(f"Sim.messageMap['{msg_id}'].path.length")
        print(f"Initial path length: {path_len}")

        # Simulate a relay hop
        await page.evaluate(f"Sim.messageMap['{msg_id}'].path.shift()")
        new_path_len = await page.evaluate(f"Sim.messageMap['{msg_id}'].path.length")
        print(f"Path length after shift: {new_path_len}")

        # Check if renderer would still show it (it should use analystPath if present)
        has_analyst_path = await page.evaluate(f"!!Sim.messageMap['{msg_id}'].analystPath")
        print(f"Has analystPath: {has_analyst_path}")

        await page.screenshot(path="verification_v2.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
