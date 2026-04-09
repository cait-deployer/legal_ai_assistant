import { Header } from "@/components/header"
import { HeroSection } from "@/components/sections/hero"
import { ForWhoSection } from "@/components/sections/for-who"
import { HowItWorksSection } from "@/components/sections/how-it-works"
import { FeaturesSection } from "@/components/sections/features"
import { ComparisonSection } from "@/components/sections/comparison"
import { PricingSection } from "@/components/sections/pricing"
import { MissionSection } from "@/components/sections/mission"
import { FaqSection } from "@/components/sections/faq"
import { CtaSection } from "@/components/sections/cta"
import { Footer } from "@/components/footer"

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED]">
      <Header />
      <HeroSection />
      <ForWhoSection />
      <HowItWorksSection />
      <FeaturesSection />
      <ComparisonSection />
      <PricingSection />
      <MissionSection />
      <FaqSection />
      <CtaSection />
      <Footer />
    </main>
  )
}
