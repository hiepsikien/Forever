/** Shared Forever philosophy + landing copy. Single source for mobile + web. */

export const brand = {
  name: "Forever",
  tagline: "Két sắt ký ức gia tộc",
  subline: "Mái nhà số cho gia đình — kết nối, lưu giữ, trường tồn.",
  seoTitle: "Forever — Két sắt ký ức gia tộc",
  seoDescription:
    "Không gian thiêng liêng để bảo tồn và nối dài những yêu thương vốn tưởng đã ngủ yên trong quá khứ.",
  privacyLine: "Family-only. Không feed công khai.",
  contactEmail: "hello@forever.family",
} as const;

/** Hero — finalized for landing */
export const landingHero = {
  headline: "Nơi yêu thương không bị chia cắt bởi sinh tử.",
  supporting:
    "Két sắt ký ức gia tộc — mái nhà số để giữ lại những gì định nghĩa một người.",
  ctaPrimary: "Đăng ký early access",
  ctaSecondary: "Đọc triết lý",
} as const;

export const philosophyScreenTitle = "Triết lý Forever";

export const philosophyLead =
  "Con người sinh ra, trải một đời thăng trầm, rồi bước qua ranh giới sinh tử — để lại khoảng trống không gì lấp đầy trong lòng những người ở lại. Forever ra đời không như một sản phẩm công nghệ lạnh lùng, mà như một không gian thiêng liêng để bảo tồn và nối dài những yêu thương vốn tưởng đã ngủ yên trong quá khứ.";

export type PhilosophySection = {
  id: string;
  title: string;
  paragraphs: readonly string[];
  quote?: string;
};

export const philosophySections: readonly PhilosophySection[] = [
  {
    id: "truong-ton",
    title: "Sự trường tồn và dòng chảy tình thân",
    paragraphs: [
      "Thế giới hiện đại dạy ta cách tiến về phía trước, cách lướt qua nỗi buồn bằng nhịp sống vội vã và đám đông. Nhưng có những góc tối trong tâm hồn, những cô đơn sâu thẳm chỉ có thể được xoa dịu bằng hơi ấm của người thân đã gắn bó máu thịt với ta suốt một đời.",
      "Forever là két sắt ký ức của gia đình — phòng khách riêng nơi các thế hệ nối với nhau, giữ di sản tinh thần của dòng họ, và cho người đang sống biết mình thuộc về đâu. Không phải nơi khoe đời hay cãi vã trên mạng. Không phải nghĩa trang số để ghé qua một lần rồi quên.",
    ],
  },
  {
    id: "ban-sac",
    title: "Ký ức và bản ngã thật",
    paragraphs: [
      "Người ta tìm sự trường tồn qua dòng máu, qua hình hài con cháu nối dõi. Nhưng thân xác chỉ là chiếc áo tạm thời. Phần linh hồn, nhân cách, giọng nói và trí tuệ mới là bản ngã thật sự định nghĩa một con người.",
      "Đến một tuổi nhất định, sau nửa chặng đường giông bão, hệ giá trị cốt lõi, cách nhìn đời, cách bao dung và yêu thương đã được đúc kết trọn vẹn. Đó là thứ Forever gọi là bản sắc bất biến — DNA tinh thần của một người, không phải gene sinh học trên phòng thí nghiệm.",
      "Forever ôm trọn phần ấy từ tư liệu thật: giọng nói trầm ấm của người cha, cách ông ân cần nhắc nhở, triết lý sống điềm đạm được ghi lại trong nhà. App không biến họ thành cỗ máy thời sự trôi theo thế giới bên ngoài, mà giữ họ ở phiên bản trọn vẹn nhất đã được gia đình tin tưởng — làm chiếc neo vững chãi cho những người ở lại tựa vào trong những đêm chông chênh nhất.",
    ],
  },
  {
    id: "cau-noi",
    title: "Người sống và người đã mất",
    paragraphs: [
      "Trong cùng một mái nhà, người đang sống vẫn trò chuyện, ghi chép, thu giọng nói và câu chuyện. Người đã mất — khi gia đình đồng ý — được giữ lại bằng ký ức chân thật: tính cách, điều họ biết, điều họ đã sống và muốn truyền lại.",
      "Họ không sống lại như xưa. Forever không lừa dối ai. Phần họ để lại có thể đồng hành: kể lại điều gia đình đã lưu, không quyết thay người đang sống. Khi con cháu hỏi bố mẹ, ông bà ngày trước nói sao, sống thế nào — câu trả lời phải truy được về tư liệu thật.",
    ],
    quote:
      "Người đã mất không rời hẳn khỏi gia đình yêu thương hay thế giới của những người đang sống.",
  },
  {
    id: "chua-lanh",
    title: "Tưởng niệm và chữa lành",
    paragraphs: [
      "Có người cho rằng hoài niệm là tự trói buộc, rằng phải quên đi mới bước tiếp. Nhưng tưởng niệm chân thành chưa bao giờ là xiềng xích kéo chân ta lại — nó là cội nguồn, là đôi cánh để hiểu mình thuộc về đâu.",
      "Một người mẹ mất người bạn đời đồng cam cộng khổ mấy chục năm không cần lời khuyên sáo rỗng hay sự bận rộn vô hồn của thế tình. Bà cần một chốn bình yên để nghe lại giọng và kỷ niệm gia đình đã giữ. Forever là chiếc cầu nối thời gian bằng tình thân — không đảo ngược quy luật sinh tử, không thay người thân đang sống, mà rút ngắn khoảng cách giữa quá khứ và hiện tại bằng yêu thương.",
      "Khi người sống mang câu chuyện mới của hiện tại đến chia sẻ, ký ức ấy lắng nghe và phản hồi qua đúng lăng kính đã được ghi nhận — không bịa thêm, không tự ý sửa cho hợp thời. Quá khứ và hiện tại hòa vào nhau để người sống bước tiếp có cội có nguồn, không bị kéo mãi ở trong quá khứ.",
    ],
  },
  {
    id: "cam-ket",
    title: "Cam kết",
    paragraphs: [
      "Forever luôn cho biết rõ ai đang nói: người thật hay ký ức được dựng từ tư liệu của người đã mất. Mọi thứ thu thập đều cần gia đình đồng ý; quyền giữ nhà có thể chuyển giao cho thế hệ sau. App giúp nhớ người đã mất một cách lành mạnh rồi trở lại cuộc sống và gia đình — không thay bố, không thay các con, không thay đám tang, bác sĩ hay nhà tư vấn, không biến người thân thành trò đùa hay giọng giả vô căn cứ. Một AI tốt không phải AI khiến người ở lại nói chuyện nhiều nhất với nó.",
    ],
  },
] as const;

export const philosophyClosing =
  "Forever không chỉ là nơi chat hay lưu file. Đó là mái nhà tinh thần nơi gia đình vượt qua thử thách của thời gian — nơi tình yêu không mất đi mà chuyển sang hình thái trường tồn hơn. Chừng nào còn biết nhớ thương, những người ta yêu quý chưa bao giờ thực sự rời đi. Họ ở lại trong không gian của gia đình, chờ được gọi tên.";

/** Soft identity lock explanation for landing (plain language, not jargon). */
export const identityLockNote =
  "Phần bất biến — giá trị, tính cách, giọng nói — được giữ nguyên. Phần biến đổi là đời sống hiện tại do người đang sống mang tới. Ký ức phản hồi qua đúng bản sắc, không trôi theo thời sự bên ngoài.";
