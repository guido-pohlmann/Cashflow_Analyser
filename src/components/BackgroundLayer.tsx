import Image from "next/image";

export function BackgroundLayer() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <Image
        src="/background_2.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,7,11,0)_0%,rgba(5,7,11,0.7)_60%,rgba(5,7,11,0.95)_100%)]" />
    </div>
  );
}
