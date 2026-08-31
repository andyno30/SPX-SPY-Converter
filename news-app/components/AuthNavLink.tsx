"use client";

import { MouseEvent, useEffect, useState } from "react";

import { getBrowserSupabaseClient } from "@/lib/supabase/client";

const LOGIN_URL =
  "https://spyconverter.com/docs/login.html?return_to=" +
  encodeURIComponent("https://news.spyconverter.com/news");

export function AuthNavLink() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (active) setIsLoggedIn(Boolean(data.user));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setIsLoggedIn(Boolean(session?.user));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!isLoggedIn) return;
    event.preventDefault();
    await getBrowserSupabaseClient().auth.signOut();
    setIsLoggedIn(false);
  }

  return (
    <span className="legacy-auth-actions">
      {isLoggedIn ? (
        <a
          href="https://spyconverter.com/docs/settings.html"
          className="legacy-settings-link"
          aria-label="Account settings"
          title="Account settings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58-1.92-3.32-2.39.96a7.3 7.3 0 0 0-1.62-.94L14.87 3h-3.84l-.38 2.18c-.58.24-1.12.56-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58c-.04.31-.07.65-.07.96s.02.62.07.92l-2.03 1.58 1.92 3.32 2.39-.96c.5.39 1.04.71 1.62.95l.38 2.17h3.84l.37-2.17c.58-.24 1.13-.56 1.63-.95l2.39.96 1.92-3.32-2.04-1.58ZM12.95 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
          </svg>
        </a>
      ) : null}
      <a href={isLoggedIn ? "#" : LOGIN_URL} onClick={handleClick}>
        {isLoggedIn ? "Log out" : "Log in"}
      </a>
    </span>
  );
}
