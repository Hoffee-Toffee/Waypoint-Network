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

        # Advance time by force-unpausing
        await page.evaluate("Sim.paused = false")
        for _ in range(50):
            await page.evaluate("tickFrame()")

        count = await page.evaluate("Sim.messages.length")
        print(f"Messages: {count}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
