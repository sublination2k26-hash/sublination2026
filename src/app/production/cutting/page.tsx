import { redirect } from "next/navigation";

export default function CuttingPage() {
  redirect("/dashboard?view=Production");
}
