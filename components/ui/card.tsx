import * as React from "react";
export function Card({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border bg-white ${className}`} {...props} />;
}
export function CardHeader({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`border-b px-4 ${className}`} {...props} />;
}
export function CardTitle({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`text-lg font-semibold ${className}`} {...props} />;
}
export function CardContent({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 ${className}`} {...props} />;
}
