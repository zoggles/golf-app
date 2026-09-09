import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import { navigate } from "./next-navigation";

type NativeLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
};

const Link = forwardRef<HTMLAnchorElement, NativeLinkProps>(function Link(
  { href, replace = false, scroll: _scroll, prefetch: _prefetch, onClick, target, ...props },
  ref,
) {
  void _scroll;
  void _prefetch;
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(href, replace);
  }

  return <a {...props} ref={ref} href={`#${href}`} target={target} onClick={handleClick} />;
});

export default Link;
