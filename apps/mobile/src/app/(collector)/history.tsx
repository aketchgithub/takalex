import { Message, Screen } from "@/components/Ui";

export default function CollectionHistoryScreen() {
  return (
    <Screen title="My deliveries" subtitle="Collector account">
      <Message>
        You have no deliveries to show. Delivery history will appear here once
        recording deliveries is available.
      </Message>
    </Screen>
  );
}
