import SwiftUI

@main
struct FoliuneApp: App {
    var body: some Scene {
        Window("Foliune", id: "main") {
            RootView()
        }
        .defaultSize(width: 1120, height: 760)
        .windowStyle(.hiddenTitleBar)
    }
}

