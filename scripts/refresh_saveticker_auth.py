#!/usr/bin/env python3
"""Refresh the local SaveTicker Playwright session through a manual login."""

import asyncio
import os
from pathlib import Path

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
AUTH_FILE = Path(os.environ.get("SAVETICKER_AUTH_FILE", ROOT / "saveticker-auth.json"))


async def main():
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=False,
            args=["--start-maximized"],
        )
        context = await browser.new_context(locale="en-US", no_viewport=True)
        page = await context.new_page()
        await page.goto(
            "https://saveticker.com/login",
            wait_until="domcontentloaded",
            timeout=60_000,
        )

        print("Log into SaveTicker in the Chromium window.")
        print("After the account is fully logged in, return here.")
        input("Press ENTER to save the refreshed session: ")

        try:
            await context.storage_state(path=str(AUTH_FILE), indexed_db=True)
        except TypeError:
            await context.storage_state(path=str(AUTH_FILE))

        os.chmod(AUTH_FILE, 0o600)
        await browser.close()

    print(f"Saved refreshed SaveTicker session to {AUTH_FILE}")
    print("Do not commit or publish this file.")


if __name__ == "__main__":
    asyncio.run(main())
