import { useNavigation } from "@react-navigation/native";
import { useLayoutEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  philosophyClosing,
  philosophyLead,
  philosophyScreenTitle,
  philosophySections,
} from "@forever/philosophy";

import { colors, fonts } from "@/lib/theme";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: string }) {
  return <Text style={styles.body}>{children}</Text>;
}

export default function PhilosophyScreen() {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({ title: philosophyScreenTitle });
  }, [navigation]);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.lead}>{philosophyLead}</Text>

      {philosophySections.map((section) => (
        <Section key={section.id} title={section.title}>
          {section.paragraphs.map((paragraph) => (
            <P key={paragraph.slice(0, 48)}>{paragraph}</P>
          ))}
          {section.quote ? (
            <View style={styles.quote}>
              <Text style={styles.quoteText}>{section.quote}</Text>
            </View>
          ) : null}
        </Section>
      ))}

      <Text style={styles.closing}>{philosophyClosing}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: 20,
    paddingBottom: 48,
    gap: 8,
    backgroundColor: colors.bg,
  },
  lead: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 28,
    color: colors.ink,
    marginBottom: 8,
  },
  section: {
    marginTop: 20,
    gap: 10,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    lineHeight: 28,
    color: colors.ink,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.inkSoft,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
    paddingLeft: 14,
    paddingVertical: 4,
    marginTop: 4,
  },
  quoteText: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 26,
    color: colors.ink,
    fontStyle: "italic",
  },
  closing: {
    marginTop: 28,
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 26,
    color: colors.brand,
    textAlign: "center",
  },
});
