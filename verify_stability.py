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

        # 1. Switch to Analyst tab
        await page.evaluate("document.getElementById('tab-analyst').click()")
        await asyncio.sleep(0.5)

        # 2. Run analysis
        await page.evaluate("document.getElementById('btn-analyst-run').click()")
        await asyncio.sleep(0.5)

        # 3. Step the simulation multiple times
        for _ in range(10):
            await page.evaluate("tickFrame()")

        # 4. Check for errors again
        if errors:
            print("Errors found during interaction:")
            for e in errors:
                print(f"  {e}")
            exit(1)
        else:
            print("Simulation stable after interaction.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
