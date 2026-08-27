type IconName = "arrow" | "check" | "edit" | "lock" | "mail" | "spark";

export function LineIcon({ name }: { name: IconName }): React.JSX.Element {
  const paths: Record<IconName, React.JSX.Element> = {
    arrow: <path d="m8 5 7 7-7 7m7-7H3" />,
    check: <path d="m5 12 4 4L19 6" />,
    edit: <path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4" />,
    lock: <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Z" />,
    mail: <path d="M3 6h18v12H3V6Zm1 1 8 6 8-6" />,
    spark: (
      <path d="M12 3c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7Z" />
    ),
  };
  return (
    <svg aria-hidden="true" className="line-icon" fill="none" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
