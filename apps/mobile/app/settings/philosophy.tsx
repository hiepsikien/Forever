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

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletMark}>·</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

export default function PhilosophyScreen() {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Triết lý Forever" });
  }, [navigation]);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.lead}>
        Forever là két sắt ký ức của một gia đình — phòng khách riêng tư, nơi
        chúng ta giữ lại những gì quý nhất và tiếp tục thuộc về nhau qua nhiều
        thế hệ.
      </Text>

      <Section title="Forever là gì">
        <P>
          Đây là nơi trò chuyện với người thân, lưu giữ ảnh và ghi chú, thu thập
          giọng nói và câu chuyện cội nguồn — rồi, khi cần, lắng nghe lại tiếng
          nói và suy nghĩ của những người ta yêu thương.
        </P>
        <P>
          Forever không cạnh tranh với Zalo hay Facebook. Ở đó, ta thường muốn
          được nhìn thấy. Ở đây, ta hỏi một câu khác: chúng ta là ai, chúng ta
          đến từ đâu, và chúng ta muốn để lại gì cho nhau?
        </P>
      </Section>

      <Section title="Forever không phải là gì">
        <Bullet>Mạng xã hội để khoe hay tìm sự chú ý.</Bullet>
        <Bullet>Nghĩa trang số tĩnh — chỉ để nhìn, không để sống cùng.</Bullet>
        <Bullet>Robot nói chuyện chung chung, bịa chuyện không có thật.</Bullet>
        <Bullet>
          Cách “hồi sinh” người đã mất như thể họ vẫn còn sống ở phòng bên cạnh.
        </Bullet>
      </Section>

      <Section title="Ba điều gia đình cần">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Di sản tinh thần</Text>
          <Text style={styles.cardBody}>
            Sợ bị lãng quên là tự nhiên. Forever giúp giữ lại giá trị sống, cách
            nói, cách an ủi — để con cháu còn nghe, còn hiểu, còn cảm thấy mình
            nối tiếp một mạch máu tinh thần.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>An toàn và thuộc về</Text>
          <Text style={styles.cardBody}>
            Một vùng riêng tư, không phán xét, không tranh luận gay gắt trực
            diện. Nơi ta được yêu thương vì là con, là cha mẹ, là anh chị em —
            không vì hồ sơ hay hình ảnh đẹp.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Neo cội nguồn</Text>
          <Text style={styles.cardBody}>
            Biết mình đứng ở đâu trong dòng họ, trong lịch sử gia đình, để bước
            tiếp vững hơn — không mất phương, không quên mình từ đâu mà có.
          </Text>
        </View>
      </Section>

      <Section title="Phòng khách số">
        <P>
          Mỗi gia đình có một không gian riêng trong Forever. Phòng khách là nơi
          trò chuyện hàng ngày. Thư viện giữ ảnh, ghi chú, âm thanh. Time-Capsule
          gợi những câu hỏi cội nguồn — trả lời bằng giọng nói, nghe lại bất cứ
          lúc nào, không cần ngồi đối diện căng thẳng.
        </P>
        <P>
          Voice DNA là lớp giọng nói: thu mẫu, chọn đoạn sạch, tạo bản giọng để
          đọc lại những câu chữ ta muốn giữ — luôn có sự đồng ý rõ ràng, luôn do
          người trong nhà quyết định.
        </P>
      </Section>

      <Section title="Ký ức và người sống">
        <P>
          Forever phân biệt rõ tin nhắn của người đang sống và phản hồi từ thực
          thể ký ức — những gì được dựng từ tư liệu thật của người đã mất hoặc
          giọng được lưu trữ.
        </P>
        <P>
          Thực thể ký ức không phải người thật. App không đánh lừa rằng bố, mẹ hay
          ông bà “vẫn còn ở đó”. Đó là cách lắng nghe lại — chân thật vừa đủ —
          để được vỗ về, rồi quay lại cuộc sống hiện tại.
        </P>
        <View style={styles.quote}>
          <Text style={styles.quoteText}>
            Forever là neo cảm xúc, không phải thuốc an thần kéo ta mãi ở trong
            quá khứ.
          </Text>
        </View>
      </Section>

      <Section title="Cái bất biến và cái thay đổi">
        <P>
          Mỗi người có một bản sắc lõi: giá trị, tính cách, cách ra quyết định,
          giọng điệu — những thứ định hình con người qua nhiều năm. Đó là phần
          bất biến, không tự ý “sống theo thời sự”.
        </P>
        <P>
          Cuộc sống hàng ngày vẫn chảy: con cái lớn, nhà cửa đổi, tin vui tin buồn
          mới. Người sống cập nhật điều đó qua trò chuyện và thư viện. Thực thể
          ký ức phản hồi trong bối cảnh mới — nhưng vẫn giữ đúng bản sắc đã được
          ghi nhận, không bịa thêm.
        </P>
      </Section>

      <Section title="Vùng đệm giữa các thế hệ">
        <P>
          Nhiều gia đình khó nói thẳng với nhau: ngượng, sợ mất thể diện, sợ bị
          hiểu lầm. Forever không ép “ngồi xuống nói cho hết ngay”. Thay vào đó:
        </P>
        <Bullet>
          Kể chuyện bất đồng bộ — ghi âm, viết, để lại khi sẵn sàng.
        </Bullet>
        <Bullet>
          Nghi thức nhỏ định kỳ — một câu hỏi, một bức ảnh cũ — không gánh nặng
          như một buổi họp mặt lớn.
        </Bullet>
        <Bullet>
          Cầu nối thời gian — con cháu nghe lại cội nguồn trước khi tranh luận
          trực diện.
        </Bullet>
        <P>
          App là vùng đệm: đủ ấm để gần nhau hơn, đủ tôn trọng để không xâm phạm
          ranh giới riêng tư của từng người.
        </P>
      </Section>

      <Section title="Cam kết của chúng tôi">
        <Bullet>
          Không bịa tiểu sử, sự kiện hay lời nói chưa có trong kho ký ức. Thiếu
          thì thừa nhận thiếu.
        </Bullet>
        <Bullet>
          Luôn gắn nhãn rõ: ai đang nói — người sống hay thực thể ký ức.
        </Bullet>
        <Bullet>
          Mọi thu thập giọng và tư liệu đều cần sự đồng ý; quyền quản trị có thể
          chuyển giao cho người giữ nhà kế nhiệm.
        </Bullet>
        <Bullet>
          Forever hỗ trợ gắn kết và tưởng nhớ — không thay tang lễ, không thay
          bác sĩ hay nhà trị liệu chuyên nghiệp.
        </Bullet>
        <Bullet>
          Giữ tôn nghiêm thực thể số: không biến thành trò đùa, deepfake tùy tiện
          hay công cụ giải trí vô căn cứ.
        </Bullet>
      </Section>

      <Section title="Món quà đầu tiên">
        <P>
          Forever bắt đầu từ một gia đình — piece by piece, từng mảnh một. Người
          nhận đầu tiên là mẹ: app phải đủ đơn giản để bà tự mở, đủ ấm để một
          buổi tối cảm thấy được vỗ vê, và đủ trung thực để cả nhà tin vào những
          gì nghe được.
        </P>
        <P>
          Thành công với chúng tôi không phải số lượt tải. Thành công là: cả nhà
          cùng góp kỷ niệm, có vài câu trả lời cội nguồn bằng giọng thật trong
          thư viện, và khi cần — xuất được toàn bộ ký ức về tay mình.
        </P>
      </Section>

      <Text style={styles.closing}>
        Chúng ta xây Forever không để sống trong quá khứ, mà để không quên mình
        thuộc về đâu — rồi bước tiếp, cùng nhau.
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
  bulletRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 8,
  },
  bulletMark: {
    fontSize: 18,
    lineHeight: 23,
    color: colors.brand,
    fontWeight: "700",
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 23,
    color: colors.inkSoft,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 21,
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
