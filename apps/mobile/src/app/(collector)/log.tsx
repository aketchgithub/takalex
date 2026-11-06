import { Message, Screen } from "@/components/Ui";

export default function CollectionLogScreen() {
  return (
    <Screen title="Log waste" subtitle="Collector account">
      <Message>
        Recording a delivery is not available yet. When it is, you will choose
        the material, enter the weight and take a photo here.
      </Message>
    </Screen>
  );
}
