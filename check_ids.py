import asyncio
from playwright.async_api import async_playwright
import os

async def check():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)
        await asyncio.sleep(1)
        ids = await page.evaluate("Object.keys(Sim.stations)")
        print(ids[:10])
        await browser.close()

if __name__ == "__main__":
    asyncio.run(check())
