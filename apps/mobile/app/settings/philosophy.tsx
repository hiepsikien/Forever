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
        Forever tồn tại để nối các thế hệ trong một gia đình, một dòng họ — giữ
        di sản tinh thần và cho người đang sống cảm giác thuộc về một cội nguồn
        chung.
      </Text>

      <Section title="Mục đích">
        <P>
          Con người sợ bị lãng quên. Gia đình cần biết mình đến từ đâu, học hỏi
          gì từ cha mẹ, ông bà, tổ tiên — rồi truyền tiếp cho con cháu. Forever
          là phòng khách riêng tư của dòng họ: nơi ký ức được gom lại, không phân
          tán, không phai theo thời gian.
        </P>
        <P>
          Không phải mạng xã hội để khoe hay tranh luận. Không phải nghĩa trang
          số chỉ để nhìn một lần rồi quên. Forever là chỗ ta quay về khi cần
          hiểu mình thuộc về ai.
        </P>
      </Section>

      <Section title="Người sống và người đã mất">
        <P>
          Trong cùng một không gian, người đang sống trò chuyện, ghi chép, thu
          giọng nói và câu chuyện. Người đã mất — với sự đồng ý của gia đình —
          được giữ lại dưới dạng ký ức số: cách nói, cách nghĩ, những gì họ đã
          trải qua và muốn để lại.
        </P>
        <P>
          Họ không “sống lại” như ngày xưa. Forever không đánh lừa ai. Nhưng cá
          tính, tri thức và trải nghiệm sống của họ vẫn có thể đồng hành — lắng
          nghe khi cần an ủi, tham khảo khi cần quyết định, truyền lại khi thế hệ
          sau hỏi: ông bà, bố mẹ ngày xưa nói thế nào, sống ra sao?
        </P>
        <View style={styles.quote}>
          <Text style={styles.quoteText}>
            Người đã mất không rời hẳn khỏi dòng họ. Họ trở thành một phần của
            những người còn đi tiếp.
          </Text>
        </View>
      </Section>

      <Section title="Di sản được giữ gìn">
        <P>
          Mỗi người mang một bản sắc: giá trị, khí chất, cách an ủi, cách khuyên
          nhủ, ký ức gắn với một thời đại. Forever ghi nhận phần bất biến đó — không
          bịa thêm, không tự ý “cập nhật” cho hợp thời. Thiếu tư liệu thì thừa nhận
          thiếu.
        </P>
        <P>
          Cuộc sống hiện tại vẫn chảy: con lớn, nhà đổi, tin mới đến. Người sống
          tiếp tục viết nên dòng họ. Ký ức của người đã mất chiếu sáng bối cảnh mới
          — như một ngọn đèn phía sau, không phải xiềng xích kéo ta ở lại quá khứ.
        </P>
      </Section>

      <Section title="Cam kết">
        <P>
          Luôn phân biệt rõ ai đang nói: người sống hay thực thể ký ức. Mọi tư
          liệu thu thập đều cần sự đồng ý. Forever hỗ trợ gắn kết và tưởng nhớ —
          không thay tang lễ, không thay chuyên gia tâm lý, không biến người thân
          thành trò đùa hay deepfake vô căn cứ.
        </P>
      </Section>

      <Text style={styles.closing}>
        Chúng ta xây Forever để dòng họ không đứt mạch — để người sống bước tiếp
        có cội, có nguồn, và có những người đã mất đi vẫn ở bên, trong ký ức
        chân thật của gia đình mình.
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
