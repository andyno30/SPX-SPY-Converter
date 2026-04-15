import { redirect } from "next/navigation";

export default function HomePage() {
  // Keep this app focused on the standalone news experience.
  redirect("/news");
}
