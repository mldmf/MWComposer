import * as React from "react";
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "destructive";
  size?: "sm" | "default" | "icon" | "xs";
  className?: string;
};
export function Button({ variant="default", size="default", className="", ...props }: ButtonProps) {
  const variants = {
    default: "bg-brand-green text-black hover:bg-brand-purple",
    secondary: "bg-brand-pink text-white hover:opacity-80",
    destructive: "bg-brand-purple text-white hover:bg-red-500"
  } as const;
  const sizes = { default:"h-10 px-4 py-2", sm:"h-9 px-3", icon:"h-9 w-9 p-0", xs:"h-7 px-2 text-xs" } as const;
  return <button className={`inline-flex items-center rounded-md text-sm font-medium ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
