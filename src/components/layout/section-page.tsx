import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { BrandLogo } from "@/components/ui/brand-logo";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  CircleDollarSign,
  FileText,
  Layers3,
  MessageSquare,
  Package,
  Shirt,
  Sparkles,
  Users,
} from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { workspaceNavigation } from "@/components/layout/navigation";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { createClient } from "@/lib/supabase/server";

type SectionPageProps = {
  title: string;
  description: string;
  area: string;
  action?: { label: string; href: string };
  children?: React.ReactNode;
};

const navigationIcons = {
  Overview: Layers3,
  Orders: Shirt,
  Production: Activity,
  Payments: CircleDollarSign,
  Customers: Users,
  Products: Package,
  Inventory: Package,
  "Document Routing": FileText,
  Messages: MessageSquare,
  Employees: Users,
  Payroll: CircleDollarSign,
  "My Salary": CircleDollarSign,
  "Time In & Out": Activity,
  "Job orders": FileText,
  Reports: Activity,
};

const roleLabels: Record<string, string> = {
  admin: "Admin / Owner",
  front_desk: "Front Desk",
  artist: "Artist / Layout Designer",
  printing: "Printing Staff",
  heat_press: "Heat Press Staff",
  cutting_sewing: "Cutting / Sewing Staff",
  qc: "Quality Control",
};

export async function SectionPage({ title, description, area, action, children }: SectionPageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name,role,active").eq("id", user.id).maybeSingle()
    : { data: null };
  const isAdmin = profile?.role === "admin" && profile.active;
  const { data: orderRows } = user ? await supabase.from("orders").select("status") : { data: [] };
  const activeOrderCount = (orderRows ?? []).filter(order => order.status !== "released" && order.status !== "cancelled").length;
  const allowedItems = isAdmin
    ? ["Overview", "Orders", "Production", "Payments", "Customers", "Products", "Inventory", "Document Routing", "Employees", "Payroll", "Job orders", "Reports"]
    : profile?.role === "front_desk"
      ? ["Overview", "Orders", "Production", "Payments", "Customers", "Job orders", "Reports"]
      : ["Production", "Job orders"];
  if (profile?.active && profile.role!=="cutting_sewing") allowedItems.push("Time In & Out");
  if (profile?.active && profile.role !== "admin") allowedItems.push("My Salary");
  const navigation = workspaceNavigation.filter(item => item.label === "Messages" || allowedItems.includes(item.label));
  const activeArea = area.split(" · ")[0];
  const displayName = profile?.full_name ?? user?.email ?? "Staff account";

  return <main className="shell">
    <MobileNavigation items={navigation} active={activeArea} name={displayName} role={roleLabels[profile?.role??""]??"Staff"}/>
    <aside className="sidebar">
      <Link className="brand" href="/dashboard">
        <BrandLogo/>
        <span>Subli-nation<br/><span className="brand-light">Printing System</span><small>PRODUCTION DESK</small></span>
      </Link>
      <div className="shop-switch"><span className="shop-avatar">S</span><span className="shop-copy"><b>Shared workspace</b><small>Subli-nation Printing System</small></span><ChevronDown size={15}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav">
        {navigation.map(item => {
          const Icon = navigationIcons[item.label as keyof typeof navigationIcons];
          return <Link key={item.href} href={item.href} className={`nav-item ${activeArea === item.label ? "active" : ""}`}>
            <Icon size={17}/>{item.label}{item.label === "Orders" && <span className="nav-count">{activeOrderCount}</span>}
          </Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="profile">
          <div className="profile-avatar">{displayName.slice(0, 2).toUpperCase()}</div>
          <div><b>{displayName}</b><small>{profile?.role ? roleLabels[profile.role] : ""}</small></div>
          {user && <SignOutButton />}
        </div>
      </div>
    </aside>

    <section className="main-area">
      <header className="topbar">
        <div className="breadcrumbs">Workspace <span>/</span> <b>{area}</b></div>
        <div className="top-actions"><ThemeToggle/><Link className="standalone-back" href="/dashboard">Dashboard <ArrowRight size={15}/></Link></div>
      </header>
      <div className="content">
        <div className="section-kicker">{area.toUpperCase()} · WORKSPACE</div>
        <div className="standalone-title-row">
          <div><h1>{title}</h1><p>{description}</p></div>
          {action && <Link className="primary-button standalone-action" href={action.href}>{action.label}<ArrowRight size={15}/></Link>}
        </div>
        <div className="standalone-panel">{children ?? <>
          <div className="standalone-empty-icon"><Layers3 size={21}/></div>
          <h2>{title} workspace</h2>
          <p>This section has its own route and is ready to be connected to the local-first workflow.</p>
          <Link href="/dashboard">Return to overview <ArrowRight size={14}/></Link>
        </>}</div>
        <footer className="standalone-footer">SUBLI-NATION PRINTING SYSTEM · SHARED WORKSPACE</footer>
      </div>
    </section>
  </main>;
}
