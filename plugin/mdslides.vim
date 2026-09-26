" plugin/mdslides.vim
" Present the current markdown buffer in the browser, live-updating as you
" edit, either as a reveal.js slide deck (one slide per heading) or as a
" continuous, normally-scrolling document -- like :MarkdownPreview, but
" sharing the same outline/navigation UI as slide mode.

if exists('g:loaded_mdslides')
  finish
endif
let g:loaded_mdslides = 1

command! -bar MDSlidesStart call mdslides#start('slides')
command! -bar MDSlidesStop call mdslides#stop()
command! -bar MDSlidesToggle call mdslides#toggle('slides')

command! -bar MDDocumentStart call mdslides#start('document')
command! -bar MDDocumentStop call mdslides#stop()
command! -bar MDDocumentToggle call mdslides#toggle('document')

augroup mdslides_cleanup
  autocmd!
  autocmd VimLeavePre * call mdslides#stop()
augroup END
