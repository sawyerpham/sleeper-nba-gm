import React from "react";

const POS_RE = /PG|SG|SF|PF|C/;
export const tierHue = (tier) => ({ "--h": Math.round(Math.min(tier - 1, 14) / 14 * 130) });

export const posClass = (text) => {
  const m = String(text || "").match(POS_RE);
  return m ? `pos-c pos-${m[0]}` : "";
};

export function PosList({ list, sep = " " }) {
  return (list || []).map((p, i) => (
    <React.Fragment key={p}>{i > 0 && sep}<span className={posClass(p)}>{p}</span></React.Fragment>
  ));
}

export function PosTag({ text, className = "" }) {
  return <span className={`${posClass(text)} ${className}`}>{text}</span>;
}
