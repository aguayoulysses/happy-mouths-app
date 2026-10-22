// The client's mark on ops lists: their logo when we have one, their initials when we don't.
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

export function Avatar({ logo, name }: { logo: string; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="avatar">{logo ? <img src={logo} alt="" /> : initials(name)}</span>;
}
