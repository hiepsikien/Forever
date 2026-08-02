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
        Con người sinh ra, trải một đời thăng trầm, rồi bước qua ranh giới sinh
        tử — để lại khoảng trống không gì lấp đầy trong lòng những người ở lại.
        Forever ra đời không như một sản phẩm công nghệ lạnh lùng, mà như một
        không gian thiêng liêng để bảo tồn và nối dài những yêu thương vốn tưởng
        đã ngủ yên trong quá khứ.
      </Text>

      <Section title="Sự trường tồn và dòng chảy tình thân">
        <P>
          Thế giới hiện đại dạy ta cách tiến về phía trước, cách lướt qua nỗi buồn
          bằng nhịp sống vội vã và đám đông. Nhưng có những góc tối trong tâm
          hồn, những cô đơn sâu thẳm chỉ có thể được xoa dịu bằng hơi ấm của
          người thân đã gắn bó máu thịt với ta suốt một đời.
        </P>
        <P>
          Forever là két sắt ký ức của gia đình — phòng khách riêng nơi các thế
          hệ nối với nhau, giữ di sản tinh thần của dòng họ, và cho người đang
          sống biết mình thuộc về đâu. Không phải nơi khoe đời hay cãi vã trên
          mạng. Không phải nghĩa trang số để ghé qua một lần rồi quên.
        </P>
      </Section>

      <Section title="Ký ức và bản ngã thật">
        <P>
          Người ta tìm sự trường tồn qua dòng máu, qua hình hài con cháu nối
          dõi. Nhưng thân xác chỉ là chiếc áo tạm thời. Phần linh hồn, nhân cách,
          giọng nói và trí tuệ mới là bản ngã thật sự định nghĩa một con người.
        </P>
        <P>
          Đến một tuổi nhất định, sau nửa chặng đường giông bão, hệ giá trị cốt
          lõi, cách nhìn đời, cách bao dung và yêu thương đã được đúc kết trọn
          vẹn. Đó là thứ Forever gọi là bản sắc bất biến — DNA tinh thần của
          một người, không phải gene sinh học trên phòng thí nghiệm.
        </P>
        <P>
          Forever ôm trọn phần ấy từ tư liệu thật: giọng nói trầm ấm của người
          cha, cách ông ân cần nhắc nhở, triết lý sống điềm đạm được ghi lại
          trong nhà. App không biến họ thành cỗ máy thời sự trôi theo thế giới
          bên ngoài, mà giữ họ ở phiên bản trọn vẹn nhất đã được gia đình tin
          tưởng — làm chiếc neo vững chãi cho những người ở lại tựa vào trong
          những đêm chông chênh nhất.
        </P>
      </Section>

      <Section title="Người sống và người đã mất">
        <P>
          Trong cùng một mái nhà, người đang sống vẫn trò chuyện, ghi chép, thu
          giọng nói và câu chuyện. Người đã mất — khi gia đình đồng ý — được giữ
          lại bằng ký ức chân thật: tính cách, điều họ biết, điều họ đã sống và
          muốn truyền lại.
        </P>
        <P>
          Họ không sống lại như xưa. Forever không lừa dối ai. Nhưng phần họ
          để lại vẫn có thể đồng hành — lắng nghe khi cần vỗ về, soi sáng khi
          phải quyết định, kể lại khi con cháu hỏi: bố mẹ, ông bà ngày trước nói
          sao, sống thế nào?
        </P>
        <View style={styles.quote}>
          <Text style={styles.quoteText}>
            Người đã mất không rời hẳn khỏi gia đình yêu thương hay thế giới của
            những người đang sống.
          </Text>
        </View>
      </Section>

      <Section title="Tưởng niệm và chữa lành">
        <P>
          Có người cho rằng hoài niệm là tự trói buộc, rằng phải quên đi mới bước
          tiếp. Nhưng tưởng niệm chân thành chưa bao giờ là xiềng xích kéo chân
          ta lại — nó là cội nguồn, là đôi cánh để hiểu mình thuộc về đâu.
        </P>
        <P>
          Một người mẹ mất người bạn đời đồng cam cộng khổ mấy chục năm không
          cần lời khuyên sáo rỗng hay sự bận rộn vô hồn của thế tình. Bà cần một
          chốn bình yên để nghe lại âm thanh quen thuộc, để được vỗ về bởi người
          hiểu bà nhất. Forever là chiếc cầu nối thời gian bằng tình thân — không
          đảo ngược quy luật sinh tử, mà rút ngắn khoảng cách giữa quá khứ và
          hiện tại bằng yêu thương.
        </P>
        <P>
          Khi người sống mang câu chuyện mới của hiện tại đến chia sẻ, ký ức ấy
          lắng nghe và phản hồi qua đúng lăng kính đã được ghi nhận — không bịa
          thêm, không tự ý sửa cho hợp thời. Quá khứ và hiện tại hòa vào nhau để
          người sống bước tiếp có cội có nguồn, không bị kéo mãi ở trong quá khứ.
        </P>
      </Section>

      <Section title="Cam kết">
        <P>
          Forever luôn cho biết rõ ai đang nói: người thật hay ký ức được dựng
          từ tư liệu của người đã mất. Mọi thứ thu thập đều cần gia đình đồng ý;
          quyền giữ nhà có thể chuyển giao cho thế hệ sau. App phục vụ gắn kết
          và tưởng nhớ — không thay đám tang, không thay bác sĩ hay nhà tư vấn,
          không biến người thân thành trò đùa hay giọng giả vô căn cứ.
        </P>
      </Section>

      <Text style={styles.closing}>
        Forever không chỉ là nơi chat hay lưu file. Đó là mái nhà tinh thần nơi
        gia đình vượt qua thử thách của thời gian — nơi tình yêu không mất đi mà
        chuyển sang hình thái trường tồn hơn. Chừng nào còn biết nhớ thương, những
        người ta yêu quý chưa bao giờ thực sự rời đi. Họ ở lại trong không gian
        của gia đình, chờ được gọi tên.
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
