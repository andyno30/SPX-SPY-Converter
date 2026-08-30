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
    <a href={isLoggedIn ? "#" : LOGIN_URL} onClick={handleClick}>
      {isLoggedIn ? "Log out" : "Log in"}
    </a>
  );
}
