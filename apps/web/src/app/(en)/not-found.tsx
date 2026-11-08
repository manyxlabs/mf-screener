import type { Metadata } from "next";
import { NotFoundView } from "@/components/not-found-view";
import en from "@/messages/en";

// Metadata cannot know the language (a not-found page gets no params), so the title is English.
export const metadata: Metadata = { title: en.notFound.title, robots: { index: false } };

export default function NotFound() {
  return <NotFoundView />;
}
