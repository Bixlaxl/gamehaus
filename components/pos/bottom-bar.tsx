"use client";

import { usePOSStore } from "@/store/pos";
import { Button } from "@/components/ui/button";
import { UserPlus, QrCode, Clock } from "lucide-react";

interface BottomBarProps {
  locationId: string;
}

export function BottomBar({ locationId: _locationId }: BottomBarProps) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-gray-800 border-t border-gray-700">
      <Button
        size="lg"
        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
        onClick={() => usePOSStore.getState().setWalkInOpen(true)}
      >
        <UserPlus className="h-5 w-5" />
        New Walk-in
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="flex-1 border-gray-600 text-white hover:bg-gray-700"
        onClick={() => usePOSStore.getState().setCheckinOpen(true)}
      >
        <QrCode className="h-5 w-5" />
        Check-in Booking
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="border-gray-600 text-white hover:bg-gray-700"
        onClick={() => usePOSStore.getState().setUpcomingOpen(true)}
      >
        <Clock className="h-4 w-4" />
        Upcoming
      </Button>
    </div>
  );
}
