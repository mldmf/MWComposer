import * as React from "react";
type Props = React.InputHTMLAttributes<HTMLInputElement> & { className?: string };
export function Input({ className="", ...props }: Props) {
  const base = "h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-gray-300 bg-white";
  if (props.type === "checkbox") return <input className={`h-4 w-4 ${className}`} {...props} />;
  return <input className={`${base} ${className}`} {...props} />;
}
