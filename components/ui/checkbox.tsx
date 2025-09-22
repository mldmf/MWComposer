import * as React from "react";
type Props = React.InputHTMLAttributes<HTMLInputElement> & { className?: string };
export function Checkbox({ className="", ...props }: Props){
  return <input type="checkbox" className={`h-4 w-4 ${className}`} {...props} />;
}
