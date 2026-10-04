#!/usr/bin/env python3
"""Deterministic Xcode project; no XcodeGen/CocoaPods dependency."""
import hashlib
from pathlib import Path
root = Path(__file__).resolve().parents[1]
def uid(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
objects = []
def add(key, content):
    objects.append(f'{uid(key)} = {{ {content} }};')
    return uid(key)
files = sorted((root / 'MyCycleWorld').rglob('*.swift'))
sources = []
children = []
for path in files:
    rel = str(path.relative_to(root))
    ref = add(rel, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "{rel}"; sourceTree = SOURCE_ROOT;')
    children.append(ref)
    sources.append(add(rel+'-build', f'isa = PBXBuildFile; fileRef = {ref};'))
resources = []
for name, kind in [('Assets.xcassets','folder.assetcatalog'), ('PrivacyInfo.xcprivacy','text.xml')]:
    ref = add(name, f'isa = PBXFileReference; lastKnownFileType = {kind}; path = "MyCycleWorld/{name}"; sourceTree = SOURCE_ROOT;')
    children.append(ref)
    resources.append(add(name+'-build', f'isa = PBXBuildFile; fileRef = {ref};'))
product = add('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = MyCycleWorld.app; sourceTree = BUILT_PRODUCTS_DIR;')
add('products', f'isa = PBXGroup; children = ({product},); name = Products; sourceTree = "<group>";')
add('group', f'isa = PBXGroup; children = ({",".join(children)},{uid("products")},); sourceTree = "<group>";')
add('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(sources)},); runOnlyForDeploymentPostprocessing = 0;')
add('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(resources)},); runOnlyForDeploymentPostprocessing = 0;')
add('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
for config in ['Debug','Release']:
    debug = config == 'Debug'
    add('project'+config, 'isa = XCBuildConfiguration; name = '+config+'; buildSettings = { CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; DEBUG_INFORMATION_FORMAT = '+('dwarf' if debug else '"dwarf-with-dsym"')+'; SWIFT_OPTIMIZATION_LEVEL = '+('"-Onone"' if debug else '"-O"')+'; '+('SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; ENABLE_TESTABILITY = YES;' if debug else 'VALIDATE_PRODUCT = YES;')+' };')
    add('app'+config, 'isa = XCBuildConfiguration; name = '+config+'; buildSettings = { ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = JQ4Z5PXR5K; CURRENT_PROJECT_VERSION = 1; MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = com.gbillois.MyCycleWorld; PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = MyCycleWorld/Info.plist; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; SUPPORTS_MACCATALYST = NO; SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; SWIFT_EMIT_LOC_STRINGS = YES; };')
for scope in ['project','app']:
    add(scope+'configs', f'isa = XCConfigurationList; buildConfigurations = ({uid(scope+"Debug")},{uid(scope+"Release")},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
add('target', f'isa = PBXNativeTarget; buildConfigurationList = {uid("appconfigs")}; buildPhases = ({uid("sources")},{uid("frameworks")},{uid("resources")},); buildRules = (); dependencies = (); name = MyCycleWorld; productName = MyCycleWorld; productReference = {product}; productType = "com.apple.product-type.application";')
add('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; TargetAttributes = {{ {uid("target")} = {{ CreatedOnToolsVersion = 27.0; ProvisioningStyle = Automatic; }}; }}; }}; buildConfigurationList = {uid("projectconfigs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = fr; hasScannedForEncodings = 0; knownRegions = (fr,en,Base,); mainGroup = {uid("group")}; productRefGroup = {uid("products")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")},);')
(root/'MyCycleWorld.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+'\n}; rootObject = '+uid('project')+'; }\n')
(root/'MyCycleWorld.xcodeproj/xcshareddata/xcschemes/MyCycleWorld.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="MyCycleWorld.app" BlueprintName="MyCycleWorld" ReferencedContainer="container:MyCycleWorld.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="MyCycleWorld.app" BlueprintName="MyCycleWorld" ReferencedContainer="container:MyCycleWorld.xcodeproj"/></BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="MyCycleWorld.app" BlueprintName="MyCycleWorld" ReferencedContainer="container:MyCycleWorld.xcodeproj"/></BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/>
<ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print('Generated MyCycleWorld.xcodeproj')
