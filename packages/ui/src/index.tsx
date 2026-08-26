import type { ButtonHTMLAttributes, JSX, PropsWithChildren } from "react";

export function ResoCard({ children }: PropsWithChildren): JSX.Element {
  return <section className="reso-card">{children}</section>;
}

export function ResoButton({
  children,
  type = "button",
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>): JSX.Element {
  return (
    <button className="reso-button" type={type} {...props}>
      {children}
    </button>
  );
}
