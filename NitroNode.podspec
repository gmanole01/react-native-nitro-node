require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroNode"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/gmanole01/react-native-nitro-node.git", :tag => "#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{h,c,hpp,cpp}",
    
    # libuv
    "deps/libuv/src/*.{h,c}",
    "deps/libuv/src/unix/async.c",
    "deps/libuv/src/unix/core.c",
    "deps/libuv/src/unix/dl.c",
    "deps/libuv/src/unix/fs.c",
    "deps/libuv/src/unix/getaddrinfo.c",
    "deps/libuv/src/unix/getnameinfo.c",
    "deps/libuv/src/unix/loop-watcher.c",
    "deps/libuv/src/unix/loop.c",
    "deps/libuv/src/unix/pipe.c",
    "deps/libuv/src/unix/poll.c",
    "deps/libuv/src/unix/process.c",
    "deps/libuv/src/unix/random-devurandom.c",
    "deps/libuv/src/unix/signal.c",
    "deps/libuv/src/unix/stream.c",
    "deps/libuv/src/unix/tcp.c",
    "deps/libuv/src/unix/thread.c",
    "deps/libuv/src/unix/tty.c",
    "deps/libuv/src/unix/udp.c",
    "deps/libuv/src/unix/darwin-proctitle.c",
    "deps/libuv/src/unix/darwin.c",
    "deps/libuv/src/unix/fsevents.c",
    "deps/libuv/src/unix/random-getentropy.c",
    "deps/libuv/src/unix/proctitle.c",
    "deps/libuv/src/unix/bsd-ifaddrs.c",
    "deps/libuv/src/unix/kqueue.c",
  ]

  # Add vendored xcframework
  s.vendored_frameworks = "ios/Frameworks/c-ares.xcframework"

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => [
      # libuv
      '"$(PODS_TARGET_SRCROOT)/deps/libuv/include"',
      # C++ implementation
      '"$(PODS_TARGET_SRCROOT)/cpp"',
      '"$(PODS_TARGET_SRCROOT)/cpp/core"',
      '"$(PODS_TARGET_SRCROOT)/cpp/io"',
      '"$(PODS_TARGET_SRCROOT)/cpp/dns"',
      '"$(PODS_TARGET_SRCROOT)/cpp/fs"',
      '"$(PODS_TARGET_SRCROOT)/cpp/os"',
      '"$(PODS_TARGET_SRCROOT)/cpp/tls"',
    ].join(' ')
  }

  load 'nitrogen/generated/ios/NitroNode+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
