import asyncio
from playwright.async_api import async_playwright
import os

async def check_errors():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        errors = []
        page.on("pageerror", lambda exc: errors.append(f"Uncaught exception: {exc}"))
        page.on("console", lambda msg: errors.append(f"Console {msg.type}: {msg.text}") if msg.type == "error" else None)

        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)

        # Wait a bit for any async init
        await asyncio.sleep(1)

        if errors:
            print("Errors found:")
            for e in errors:
                print(f"  {e}")
        else:
            print("No errors found on load.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(check_errors())
