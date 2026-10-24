# C ABI tests and example (specs/design.md §9.2). Build the library first:
#   cargo build -p mumble-ffi --release
#   cmake -S bindings/c -B build/c && cmake --build build/c && ctest --test-dir build/c
cmake_minimum_required(VERSION 3.20)
project(mumble_c C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(MUMBLE_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../target/release"
    CACHE PATH "Directory containing the mumble_ffi shared library")

add_library(mumble SHARED IMPORTED)
if(WIN32)
  set_target_properties(mumble PROPERTIES
    IMPORTED_LOCATION "${MUMBLE_LIB_DIR}/mumble_ffi.dll"
    IMPORTED_IMPLIB "${MUMBLE_LIB_DIR}/mumble_ffi.dll.lib")
elseif(APPLE)
  set_target_properties(mumble PROPERTIES IMPORTED_LOCATION "${MUMBLE_LIB_DIR}/libmumble_ffi.dylib")
else()
  set_target_properties(mumble PROPERTIES IMPORTED_LOCATION "${MUMBLE_LIB_DIR}/libmumble_ffi.so")
endif()
set_target_properties(mumble PROPERTIES INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_CURRENT_SOURCE_DIR}/include")

function(mumble_executable name source)
  add_executable(${name} ${source})
  target_link_libraries(${name} PRIVATE mumble)
  if(MSVC)
    # C4127: `do { } while (0)` in macros; fopen is fine in an example.
    target_compile_options(${name} PRIVATE /W4 /WX /wd4127)
    target_compile_definitions(${name} PRIVATE _CRT_SECURE_NO_WARNINGS)
  else()
    target_compile_options(${name} PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  if(WIN32)
    # Windows finds DLLs next to the executable.
    add_custom_command(TARGET ${name} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE:mumble> $<TARGET_FILE_DIR:${name}>)
  endif()
endfunction()

mumble_executable(test_vectors tests/test_vectors.c)
target_include_directories(test_vectors PRIVATE tests)
mumble_executable(hello examples/hello.c)

enable_testing()
add_test(NAME vectors COMMAND test_vectors)
add_test(NAME hello COMMAND hello "${CMAKE_CURRENT_BINARY_DIR}/hello.wav")
