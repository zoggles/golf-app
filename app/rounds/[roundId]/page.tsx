import { RoundDetailPage } from "@/components/round-detail-page";

export default async function Page({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  return <RoundDetailPage roundId={roundId} />;
}
