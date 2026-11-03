import SwiftUI

/// 工程初始化窗口；业务页面在确认实现范围后加入。
struct RootView: View {
    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("Foliune")
                .font(.system(size: 64, weight: .regular, design: .serif))
                .accessibilityAddTraits(.isHeader)

            Text("For photographs worth returning to.")
                .font(.system(size: 17))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer()

            Text("工程已就绪 · 功能开发尚未开始")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.bottom, 28)
        }
        .padding(.horizontal, 48)
        .frame(minWidth: 640, maxWidth: .infinity, minHeight: 480, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

