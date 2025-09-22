"use client";
import * as React from "react";
const TabsContext = React.createContext<{value:string,setValue:(v:string)=>void} | null>(null);
export function Tabs({ defaultValue, value, onValueChange, children }:{ defaultValue?:string, value?:string, onValueChange?:(v:string)=>void, children:React.ReactNode }){
  const [v,setV] = React.useState(value ?? defaultValue ?? "0");
  React.useEffect(()=>{ if(value!==undefined) setV(value); },[value]);
  const ctx = React.useMemo(()=>({ value:v, setValue:(nv:string)=>{ setV(nv); onValueChange?.(nv);} }),[v,onValueChange]);
  return <TabsContext.Provider value={ctx}><div>{children}</div></TabsContext.Provider>;
}
export function TabsList({ children, className="" }:{children:React.ReactNode,className?:string}){
  return <div className={`inline-flex rounded-lg border bg-white p-1 gap-1 ${className}`}>{children}</div>;
}

export function TabsTrigger({ value, children }:{ value:string, children:React.ReactNode }) {
  const ctx = React.useContext(TabsContext)!;
  const active = ctx.value === value;

  return (
    <button
      onClick={() => ctx.setValue(value)}
      className={`px-3 py-1 rounded-md text-sm border transition-colors
        ${active
          ? "bg-brand-green text-black border-brand-green"
          : "bg-white text-gray-800 hover:bg-brand-pink hover:text-white border-gray-300"}`}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }:{ value:string, children:React.ReactNode }){
  const ctx = React.useContext(TabsContext)!;
  if (ctx.value !== value) return null;
  return <div className="mt-3">{children}</div>;
}
