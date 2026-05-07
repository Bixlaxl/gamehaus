export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Configuration</h2>
        <p className="text-sm text-gray-500">
          Location-specific settings are managed in the Locations section.
          Staff accounts are managed in the Staff section.
        </p>
      </div>
    </div>
  );
}
