import { BackgroundLayer } from "@/components/BackgroundLayer";
import { Hero } from "@/components/Hero";
import { UrlAnalyzerCard } from "@/components/UrlAnalyzerCard";

export default function Home() {
  return (
    <>
      <BackgroundLayer />
      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-16">
        <Hero />
        <UrlAnalyzerCard />
      </main>
    </>
  );
}
