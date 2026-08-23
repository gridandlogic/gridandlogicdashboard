"use client";
import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import {
  IconLayoutDashboard,
  IconLayoutKanban,
  IconHash,
  IconMessageCircle,
  IconVideo,
  IconBell,
  IconShieldCog,
  IconArrowLeft,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { AppProvider, useApp } from "@/components/providers/app-provider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, unreadCount, supabase } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: <IconLayoutDashboard className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Sprint Boards",
      href: "/dashboard/boards",
      icon: <IconLayoutKanban className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Channels",
      href: "/dashboard/channels",
      icon: <IconHash className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Messages",
      href: "/dashboard/dm",
      icon: <IconMessageCircle className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Meetings",
      href: "/dashboard/meetings",
      icon: <IconVideo className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Notifications",
      href: "/dashboard/notifications",
      icon: <IconBell className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
      badge: unreadCount,
    },
    ...(isAdmin
      ? [
          {
            label: "Admin",
            href: "/dashboard/admin",
            icon: <IconShieldCog className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
          },
        ]
      : []),
  ];

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-1 flex-col overflow-hidden bg-gray-100 md:flex-row dark:bg-neutral-800",
        "h-screen"
      )}
    >
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-10">
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <SidebarLink
                  key={idx}
                  link={link}
                  className={cn(
                    pathname === link.href && "rounded-md bg-neutral-200 px-2 dark:bg-neutral-700"
                  )}
                />
              ))}
              <button
                onClick={logout}
                className="flex items-center justify-start gap-2 group/sidebar py-2 cursor-pointer"
              >
                <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
                {open && (
                  <span className="text-neutral-700 dark:text-neutral-200 text-sm whitespace-pre">
                    Logout
                  </span>
                )}
              </button>
            </div>
          </div>
          <div>
            <SidebarLink
              link={{
                label: `${profile.first_name} ${profile.last_name}`,
                href: "/dashboard/profile",
                icon: (
                  <Avatar profile={profile} />
                ),
              }}
            />
          </div>
        </SidebarBody>
      </Sidebar>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex h-full w-full flex-1 flex-col overflow-hidden rounded-tl-2xl border border-neutral-200 bg-white md:rounded-tl-2xl dark:border-neutral-700 dark:bg-neutral-900">
          {children}
        </div>
      </div>
    </div>
  );
}

function Avatar({ profile }: { profile: { first_name: string; last_name: string; avatar_url: string | null } }) {
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
        width={50}
        height={50}
        alt="Avatar"
      />
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">
      {profile.first_name?.[0]}
      {profile.last_name?.[0]}
    </div>
  );
}

export const Logo = () => {
  return (
    <a
      href="/dashboard"
      className="relative z-20 flex items-center space-x-2 py-1 text-sm font-normal text-black"
    >
      <img src="/logo.svg" alt="Grid & Logic" className="h-6 w-6 shrink-0" />
      <motion.span
        animate={{ opacity: 1 }}
        className="font-medium whitespace-pre text-black dark:text-white"
      >
        Grid &amp; Logic
      </motion.span>
    </a>
  );
};

export const LogoIcon = () => {
  return (
    <a
      href="/dashboard"
      className="relative z-20 flex items-center space-x-2 py-1 text-sm font-normal text-black"
    >
      <img src="/logo.svg" alt="Grid & Logic" className="h-6 w-6 shrink-0" />
    </a>
  );
};
