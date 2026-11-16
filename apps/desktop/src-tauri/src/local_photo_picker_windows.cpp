#include <windows.h>
#include <shobjidl.h>
#include <wrl/implements.h>
#include <cwchar>

using namespace Microsoft::WRL;

namespace {
constexpr DWORD chooseSelection = 100;

class SelectionEvents final : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
    IFileDialogEvents, IFileDialogControlEvents> {
public:
    ComPtr<IShellItemArray> selected;

    IFACEMETHODIMP OnButtonClicked(IFileDialogCustomize *controls, DWORD id) override {
        if (id != chooseSelection) return S_OK;
        ComPtr<IFileOpenDialog> dialog;
        HRESULT result = controls->QueryInterface(IID_PPV_ARGS(dialog.GetAddressOf()));
        if (FAILED(result)) return result;
        ComPtr<IShellItemArray> items;
        result = dialog->GetSelectedItems(items.GetAddressOf());
        if (FAILED(result)) return result;
        DWORD count = 0;
        result = items->GetCount(&count);
        if (FAILED(result) || !count) return result;
        // The normal Open action navigates into a selected folder. Capture the
        // view selection here before Close, which does not expose GetResults.
        selected = items;
        result = dialog->Close(S_OK);
        if (FAILED(result)) selected.Reset();
        return result;
    }

    IFACEMETHODIMP OnFileOk(IFileDialog *) override { return S_OK; }
    IFACEMETHODIMP OnFolderChanging(IFileDialog *, IShellItem *) override { return S_OK; }
    IFACEMETHODIMP OnFolderChange(IFileDialog *) override { return S_OK; }
    IFACEMETHODIMP OnSelectionChange(IFileDialog *) override { return S_OK; }
    IFACEMETHODIMP OnTypeChange(IFileDialog *) override { return S_OK; }
    IFACEMETHODIMP OnShareViolation(IFileDialog *, IShellItem *, FDE_SHAREVIOLATION_RESPONSE *response) override {
        *response = FDESVR_DEFAULT;
        return S_OK;
    }
    IFACEMETHODIMP OnOverwrite(IFileDialog *, IShellItem *, FDE_OVERWRITE_RESPONSE *response) override {
        *response = FDEOR_DEFAULT;
        return S_OK;
    }
    IFACEMETHODIMP OnItemSelected(IFileDialogCustomize *, DWORD, DWORD) override { return S_OK; }
    IFACEMETHODIMP OnCheckButtonToggled(IFileDialogCustomize *, DWORD, BOOL) override { return S_OK; }
    IFACEMETHODIMP OnControlActivating(IFileDialogCustomize *, DWORD) override { return S_OK; }
};

using AddPath = bool (*)(void *, const wchar_t *, size_t);

HRESULT choose(HWND parent, void *context, AddPath addPath) {
    ComPtr<IFileOpenDialog> dialog;
    HRESULT result = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(dialog.GetAddressOf()));
    if (FAILED(result)) return result;
    FILEOPENDIALOGOPTIONS options;
    if (FAILED(result = dialog->GetOptions(&options))) return result;
    if (FAILED(result = dialog->SetOptions(options | FOS_ALLOWMULTISELECT | FOS_FORCEFILESYSTEM))) return result;
    const COMDLG_FILTERSPEC filters[] = {{L"照片（JPEG / PNG / WebP）", L"*.jpg;*.jpeg;*.png;*.webp"}};
    if (FAILED(result = dialog->SetFileTypes(ARRAYSIZE(filters), filters))) return result;
    if (FAILED(result = dialog->SetTitle(L"选择照片或文件夹"))) return result;
    if (FAILED(result = dialog->SetOkButtonLabel(L"打开照片"))) return result;

    ComPtr<IFileDialogCustomize> controls;
    if (FAILED(result = dialog.As(&controls))) return result;
    if (FAILED(result = controls->AddPushButton(chooseSelection, L"使用所选项目"))) return result;
    auto events = Make<SelectionEvents>();
    if (!events) return E_OUTOFMEMORY;
    DWORD cookie = 0;
    if (FAILED(result = dialog->Advise(events.Get(), &cookie))) return result;
    result = dialog->Show(parent);
    dialog->Unadvise(cookie);
    if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return S_OK;
    if (FAILED(result)) return result;

    ComPtr<IShellItemArray> selection = events->selected;
    if (!selection && FAILED(result = dialog->GetResults(selection.GetAddressOf()))) return result;
    DWORD count = 0;
    if (FAILED(result = selection->GetCount(&count))) return result;
    for (DWORD index = 0; index < count; ++index) {
        ComPtr<IShellItem> item;
        if (FAILED(result = selection->GetItemAt(index, item.GetAddressOf()))) return result;
        PWSTR path = nullptr;
        if (FAILED(result = item->GetDisplayName(SIGDN_FILESYSPATH, &path))) return result;
        bool valid = addPath(context, path, std::wcslen(path));
        CoTaskMemFree(path);
        if (!valid) return HRESULT_FROM_WIN32(ERROR_NO_UNICODE_TRANSLATION);
    }
    return S_OK;
}
}

extern "C" HRESULT foliune_choose_local_photo_sources_windows(HWND parent, void *context, AddPath addPath) {
    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    if (FAILED(result)) return result;
    result = choose(parent, context, addPath);
    CoUninitialize();
    return result;
}
