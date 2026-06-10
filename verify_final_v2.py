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

        # Force start
        await page.evaluate("UI.play()")

        # Switch to Analyst
        await page.evaluate("document.getElementById('tab-analyst').click()")
        await asyncio.sleep(0.5)

        # SelectGJ 3512 Station to GJ 3379 Station (known good path)
        await page.evaluate("""
            document.getElementById('analyst-source').value = 'gj_3512_station';
            document.getElementById('analyst-dest').value = 'gj_3379_station';
        """)

        # Click Run
        await page.evaluate("document.getElementById('btn-analyst-run').click()")
        await asyncio.sleep(0.5)

        # Run for a bit to see coordination in action
        for _ in range(200):
            await page.evaluate("tickFrame()")

        logs = await page.evaluate("document.getElementById('log-entries').innerText")
        print("Final Log Snippet:")
        print("\n".join(logs.split("\n")[-15:]))

        await page.screenshot(path="final_protocol_verification.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
