import { NextResponse } from "next/server";
import { readdir } from "fs/promises";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const root = searchParams.get("root");

  if (!root) {
    return NextResponse.json({ files: [], error: "missing root" }, { status: 400 });
  }

  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ files: [], error: message }, { status: 500 });
  }
}
