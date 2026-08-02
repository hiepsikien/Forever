import { useNavigation } from "@react-navigation/native";
import { useLayoutEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

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
    navigation.setOptions({ title: "Triết lý Forever" });
  }, [navigation]);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.lead}>
        Forever giúp các thế hệ trong một gia đình, một dòng họ nối với nhau —
        giữ lại những gì quý nhất, và cho người đang sống biết mình thuộc về đâu.
      </Text>

      <Section title="Mục đích">
        <P>
          Ai cũng sợ một ngày bị lãng quên. Gia đình cần biết mình từ đâu mà có,
          học được gì từ cha mẹ, ông bà, rồi truyền lại cho con cháu. Forever
          như phòng khách riêng của cả nhà: ký ức được gom một chỗ, không rải
          rác, không phai dần theo năm tháng.
        </P>
        <P>
          Đây không phải nơi khoe đời hay cãi nhau trên mạng. Cũng không phải
          nghĩa trang số để vào xem một lần rồi thôi. Forever là chỗ ta quay về
          khi muốn nhớ mình là con ai, cháu ai.
        </P>
      </Section>

      <Section title="Người sống và người đã mất">
        <P>
          Trong cùng một nhà, người đang sống vẫn trò chuyện, ghi chép, thu giọng
          nói và câu chuyện. Người đã mất — khi gia đình đồng ý — được giữ lại
          bằng ký ức thật: giọng nói, cách nghĩ, những chuyện đã trải qua và
          muốn để lại.
        </P>
        <P>
          Họ không sống lại như xưa. Forever không lừa dối ai. Nhưng tính cách,
          điều họ biết, điều họ đã sống vẫn có thể ở bên — để nghe khi cần vỗ về,
          để nhớ khi phải quyết định, để kể lại khi con cháu hỏi: bố mẹ, ông bà
          ngày trước nói sao, sống thế nào?
        </P>
        <View style={styles.quote}>
          <Text style={styles.quoteText}>
            Người đã mất không rời hẳn khỏi gia đình yêu thương hay thế giới của
            những người đang sống.
          </Text>
        </View>
      </Section>

      <Section title="Di sản được giữ gìn">
        <P>
          Mỗi người có một cách riêng: điều tin, cách an ủi, cách khuyên, những
          kỷ niệm gắn với một thời. Forever ghi nhận đúng phần đó — không bịa
          thêm, không tự ý sửa cho hợp thời. Thiếu thì nói thẳng là thiếu.
        </P>
        <P>
          Cuộc sống vẫn trôi: con lớn, nhà đổi, tin vui tin buồn mới. Người sống
          vẫn viết tiếp câu chuyện gia đình. Ký ức người đã mất soi sáng những
          ngày hôm nay — như đèn phía sau lưng, không phải dây trói kéo ta mãi ở
          quá khứ.
        </P>
      </Section>

      <Section title="Cam kết">
        <P>
          App luôn cho biết rõ ai đang nói: người thật hay ký ức được ghi lại từ
          người đã mất. Mọi thứ thu thập đều cần gia đình đồng ý. Forever giúp
          nhớ và gắn kết — không thay đám tang, không thay bác sĩ hay nhà tư vấn,
          không biến người thân thành trò đùa hay giọng giả vô căn cứ.
        </P>
      </Section>

      <Text style={styles.closing}>
        Ta làm Forever để dòng họ không đứt đoạn — để người sống bước tiếp có cội
        có nguồn, và để những người đã mất vẫn ở bên, trong ký ức thật của gia
        đình mình.
      </Text>
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
    fontSize: 20,
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
    fontSize: 22,
    color: colors.ink,
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
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
    lineHeight: 25,
    color: colors.ink,
    fontStyle: "italic",
  },
  closing: {
    marginTop: 28,
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 26,
    color: colors.brand,
    textAlign: "center",
  },
});
