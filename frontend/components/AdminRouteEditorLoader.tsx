"use client";

import dynamic from "next/dynamic";

const AdminRouteEditor = dynamic(() => import("./AdminRouteEditor"), {
  ssr: false,
});

export default function AdminRouteEditorLoader() {
  return <AdminRouteEditor />;
}

