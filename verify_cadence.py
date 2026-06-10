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

        # 1. Check initial heartbeats
        initial_count = await page.evaluate("Sim.messages.length")
        print(f"Initial heartbeats: {initial_count}")

        # 2. Advance time by 40s (more than 30s cadence)
        for _ in range(40):
            await page.evaluate("tickFrame()")

        count_after = await page.evaluate("Sim.messages.length")
        print(f"Messages after 40s: {count_after}")

        if count_after > initial_count:
            print("Cadence check: Success. New heartbeats generated.")
        else:
            print("Cadence check: FAILED. No new heartbeats.")

        await page.screenshot(path="verification_cadence.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
